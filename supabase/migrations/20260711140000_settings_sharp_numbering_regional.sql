-- ============================================================
-- Settings "sharp": configurable invoice numbering + org currency
--
-- 1. company_settings.invoice_prefix — the 'INV-' prefix was hardcoded inside
--    invoice_next_number(). Pros migrating from another system want their own
--    prefix (e.g. FAC-) and to continue their sequence.
-- 2. invoice_next_number() now reads the org's prefix (default 'INV-').
-- 3. set_invoice_next_number(org, n) — admin-gated way to (re)start the
--    sequence, e.g. continue at 0433 after migrating.
-- 4. get_invoice_next_number(org) — member-gated read for the settings UI
--    (invoice_sequences itself stays service/definer-only).
-- 5. company_settings.currency — org display currency (CAD default), consumed
--    by the tax preview now, available for wider use.
-- ============================================================

begin;

alter table public.company_settings
  add column if not exists invoice_prefix text not null default 'INV-',
  add column if not exists currency text not null default 'CAD';

-- ── invoice_next_number: same concurrency-safe counter, org-configurable prefix ──
create or replace function public.invoice_next_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_next integer;
  v_prefix text;
begin
  insert into public.invoice_sequences (org_id, last_value)
  values (p_org, 0)
  on conflict (org_id) do nothing;

  update public.invoice_sequences
  set last_value = last_value + 1,
      updated_at = now()
  where org_id = p_org
  returning last_value into v_next;

  select coalesce(nullif(trim(invoice_prefix), ''), 'INV-')
    into v_prefix
    from public.company_settings
   where org_id = p_org
   limit 1;

  return coalesce(v_prefix, 'INV-') || lpad(v_next::text, 6, '0');
end;
$fn$;

-- ── set the NEXT number (admin/owner only) ──
create or replace function public.set_invoice_next_number(p_org uuid, p_next integer)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), p_org) then
    raise exception 'Only org owners or admins can change invoice numbering.' using errcode = '42501';
  end if;
  if p_next is null or p_next < 1 or p_next > 99999999 then
    raise exception 'Next invoice number must be between 1 and 99999999.';
  end if;

  insert into public.invoice_sequences (org_id, last_value, updated_at)
  values (p_org, p_next - 1, now())
  on conflict (org_id) do update
    set last_value = excluded.last_value,
        updated_at = now();
end;
$fn$;
revoke all on function public.set_invoice_next_number(uuid, integer) from public, anon;
grant execute on function public.set_invoice_next_number(uuid, integer) to authenticated, service_role;

-- ── read the NEXT number (any org member, for the settings UI) ──
create or replace function public.get_invoice_next_number(p_org uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_last integer;
begin
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  select last_value into v_last from public.invoice_sequences where org_id = p_org;
  return coalesce(v_last, 0) + 1;
end;
$fn$;
revoke all on function public.get_invoice_next_number(uuid) from public, anon;
grant execute on function public.get_invoice_next_number(uuid) to authenticated, service_role;

commit;
