-- ═══════════════════════════════════════════════════════════════
-- P2-F — Verrouiller les 3 tables archive.orphans_* (PII sans RLS)
--        + élargir la sonde de couverture RLS aux schémas app/archive
-- ───────────────────────────────────────────────────────────────
-- 20260618153753_cleanup_orphans.sql a créé 3 tables dans le schéma `archive`
-- pour sauvegarder des orphelins purgés le 2026-07-10. Ce sont les seules
-- tables du dump SANS RLS, et elles contiennent de la PII (billing_email,
-- full_name, address, stripe_customer_id…). Elles ne sont pas exposées par
-- PostgREST (schéma non-API, aucun grant) — risque faible aujourd'hui — mais
-- la reprise de juillet est terminée depuis 2 mois et cette PII est conservée
-- hors politique de rétention.
--
-- Choix : VERROUILLER (deny-all) plutôt que DROP — ne pas détruire une trace
-- de reprise de façon irréversible. Destruction planifiée le 2026-10-10 (à
-- faire manuellement après confirmation). RLS + FORCE + revoke = deny-all
-- effectif (aucune policy => aucune ligne visible, même pour le propriétaire
-- des tables via un client applicatif).
-- ═══════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'orphans_memberships_20260710',
    'orphans_billing_profiles_20260710',
    'orphans_org_invoice_sequences_20260710'
  ] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
               where n.nspname='archive' and c.relname=t and c.relkind='r') then
      execute format('alter table archive.%I enable row level security', t);
      execute format('alter table archive.%I force row level security', t);
      execute format('revoke all on archive.%I from anon, authenticated', t);
      execute format($c$comment on table archive.%I is 'deny-all volontaire — PII d''orphelins juillet 2026, à détruire le 2026-10-10'$c$, t);
    end if;
  end loop;
end $$;

-- Élargir la sonde de couverture RLS aux schémas app + archive (elle ne
-- regardait que public → les tables archive lui échappaient en permanence).
create or replace function public.check_rls_coverage()
returns table(table_name text, rls_enabled boolean, rls_forced boolean, policy_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.relname::text, c.relrowsecurity, c.relforcerowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','app','archive') and c.relkind = 'r'
     and (not c.relrowsecurity
          or not c.relforcerowsecurity
          or (not exists (select 1 from pg_policy p where p.polrelid = c.oid)
              -- deny-all assumé : déclaré dans le commentaire de la table
              and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%deny-all volontaire%'));
$$;

revoke all on function public.check_rls_coverage() from public, anon, authenticated;
