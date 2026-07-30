-- ============================================================================
-- N7.10 — La correction se prouve, elle ne se croit pas
-- ============================================================================
-- Un invariant non teste est une hypothese, et les hypotheses se degradent a
-- chaque deploiement. Les fonctions ci-dessous doivent TOUTES retourner 0 ligne.
-- A brancher sur un cron (pg_cron ou GitHub Actions) avec alerte si non vide.
--
-- Elles ne modifient rien : ce sont des sondes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Aucune reference cross-tenant, sur TOUTES les relations concernees.
--    Genere dynamiquement : couvre automatiquement les futures FK.
-- ----------------------------------------------------------------------------
create or replace function public.check_cross_tenant_references()
returns table (relation text, violations bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count bigint;
begin
  for r in
    select c.conrelid::regclass::text as child,
           c.confrelid::regclass::text as parent,
           a.attname as fkcol
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> c.confrelid
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.conrelid and x.attname = 'org_id' and not x.attisdropped)
       and exists (select 1 from pg_attribute x
                    where x.attrelid = c.confrelid and x.attname = 'org_id' and not x.attisdropped)
  loop
    execute format(
      'select count(*) from public.%I c join public.%I p on p.id = c.%I '
      'where c.org_id is distinct from p.org_id',
      r.child, r.parent, r.fkcol
    ) into v_count;

    if v_count > 0 then
      relation := format('%s.%s -> %s', r.child, r.fkcol, r.parent);
      violations := v_count;
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.check_cross_tenant_references() from public, anon, authenticated;

comment on function public.check_cross_tenant_references() is
  'N7.10 — Doit retourner 0 ligne. Toute ligne = donnees melangees entre orgs.';

-- ----------------------------------------------------------------------------
-- 2. Coherence des totaux de facture avec leurs lignes (N-erreur 7).
--    Ne s'applique qu'aux factures emises (pas aux brouillons en cours de saisie).
-- ----------------------------------------------------------------------------
create or replace function public.check_invoice_totals_balance()
returns table (invoice_id uuid, org_id uuid, invoice_number text,
               stored_subtotal_cents integer, computed_subtotal_cents bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.org_id, i.invoice_number, i.subtotal_cents,
         coalesce(sum(ii.line_total_cents), 0)
    from public.invoices i
    left join public.invoice_items ii
      on ii.invoice_id = i.id and ii.deleted_at is null
   where i.deleted_at is null
     and i.status not in ('draft', 'void')
   group by i.id, i.org_id, i.invoice_number, i.subtotal_cents
  having i.subtotal_cents is distinct from coalesce(sum(ii.line_total_cents), 0);
$$;

revoke all on function public.check_invoice_totals_balance() from public, anon, authenticated;

comment on function public.check_invoice_totals_balance() is
  'N-erreur 7 — Doit retourner 0 ligne. Total stocke qui ne balance pas avec '
  'ses lignes. Exclut les brouillons et les factures annulees.';

-- ----------------------------------------------------------------------------
-- 3. Tables sans RLS forcee (regression de 20260751100000).
-- ----------------------------------------------------------------------------
create or replace function public.check_rls_coverage()
returns table (table_name text, rls_enabled boolean, rls_forced boolean, policy_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.relname::text, c.relrowsecurity, c.relforcerowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (not c.relrowsecurity
          or not c.relforcerowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
$$;

revoke all on function public.check_rls_coverage() from public, anon, authenticated;

comment on function public.check_rls_coverage() is
  'N3.4 — Doit retourner 0 ligne. Table sans RLS activee, sans RLS forcee, '
  'ou avec RLS mais aucune policy (donc inaccessible silencieusement).';

-- ----------------------------------------------------------------------------
-- 4. Sonde globale : agrege tout, pour un seul appel en cron.
-- ----------------------------------------------------------------------------
create or replace function public.check_all_invariants()
returns table (check_name text, failures bigint, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  check_name := 'cross_tenant_references';
  select count(*), coalesce(string_agg(relation || '=' || violations, ', '), '')
    into failures, detail from public.check_cross_tenant_references();
  return next;

  check_name := 'invoice_totals_balance';
  select count(*), coalesce(string_agg(invoice_number, ', '), '')
    into failures, detail from public.check_invoice_totals_balance();
  return next;

  check_name := 'rls_coverage';
  select count(*), coalesce(string_agg(table_name, ', '), '')
    into failures, detail from public.check_rls_coverage();
  return next;

  check_name := 'invoice_numbering';
  select count(*), coalesce(string_agg(invoice_number, ', '), '')
    into failures, detail from public.check_invoice_numbering_invariant();
  return next;

  check_name := 'custom_field_orphans';
  select count(*), coalesce(string_agg(record_id::text, ', '), '')
    into failures, detail from public.check_custom_field_orphans();
  return next;
end $$;

revoke all on function public.check_all_invariants() from public, anon, authenticated;

comment on function public.check_all_invariants() is
  'N7.10 — Sonde unique pour le cron. Toute ligne avec failures > 0 doit alerter.';
