-- ============================================================================
-- N3.4 — FORCE ROW LEVEL SECURITY sur toutes les tables du schema public
-- ============================================================================
-- Constat audit : RLS activee sur 218/218 tables, FORCEE sur 0.
-- Sans FORCE, le proprietaire de la table (postgres) contourne ses propres
-- policies. Avec FORCE, meme le proprietaire y est soumis.
--
-- SECURITE DE CETTE MIGRATION :
--   service_role et postgres ont rolbypassrls = true (verifie en prod).
--   BYPASSRLS est evalue AVANT force_row_level_security, donc getServiceClient()
--   continue de fonctionner exactement comme avant. Aucun impact applicatif.
--
-- Idempotent : re-executable sans effet de bord.
-- ============================================================================

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.oid::regclass::text as tbl
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity          -- RLS deja activee
       and not c.relforcerowsecurity -- mais pas forcee
     order by 1
  loop
    execute format('alter table %s force row level security', r.tbl);
    n := n + 1;
  end loop;

  raise notice 'FORCE RLS applique sur % table(s).', n;
end $$;

-- ----------------------------------------------------------------------------
-- Verification : doit retourner 0 ligne.
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not c.relforcerowsecurity;

  if v_missing > 0 then
    raise exception 'FORCE RLS incomplet : % table(s) restantes.', v_missing;
  end if;
end $$;
