-- ═══════════════════════════════════════════════════════════════
-- Tenant hopping — WITH CHECK sur toutes les policies UPDATE
--
-- Appliqué en production; consigné ici pour survivre à un `db reset`.
--
-- Sans WITH CHECK, Postgres réutilise USING pour valider la nouvelle
-- ligne. USING contraint la ligne AVANT modification et ne dit rien de
-- la ligne APRÈS : un membre pouvait donc exécuter
--   update quotes set org_id = '<autre org>' where id = '<la mienne>'
-- et déplacer ses soumissions, tâches, configs de taxes ou invitations
-- vers une autre organisation.
--
-- 49 policies étaient concernées — la première passe manuelle n'en avait
-- trouvé que 6. D'où l'application par programme : recopier le prédicat
-- USING en WITH CHECK, sans exception possible.
--
-- Le prédicat est identique à celui d'avant : aucun accès légitime n'est
-- retiré, seule l'écriture qui SORT de son organisation devient
-- impossible. Vérifié après application : 144 policies ont un WITH CHECK
-- identique à leur USING, et 0 des 106 opérations d'écriture du front
-- est bloquée.
--
-- La garde H de scripts/test-rls-isolation.ts empêche la réapparition :
-- toute nouvelle policy UPDATE sans WITH CHECK fait échouer la CI.
-- ═══════════════════════════════════════════════════════════════


-- ── Policies UPDATE ───────────────────────────────────────────
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.qual
    from pg_policies p
    join pg_class c on c.relname = p.tablename
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    where p.schemaname = 'public'
      and p.cmd = 'UPDATE'
      and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
      and p.with_check is null
      and p.qual is not null
      and has_table_privilege('authenticated', c.oid, 'update')
  loop
    execute format('alter policy %I on public.%I with check (%s)',
                   r.policyname, r.tablename, r.qual);
    n := n + 1;
  end loop;
  raise notice 'WITH CHECK ajouté à % policy(ies) UPDATE', n;
end $$;


-- ── Policies FOR ALL ──────────────────────────────────────────
--
-- ALTER POLICY ne peut pas ajouter un WITH CHECK à une policy ALL sans
-- redéfinir ses deux volets : on la recrée à l'identique. FOR ALL cache
-- des trous par nature — il fusionne 4 commandes sous un seul prédicat,
-- et l'absence de WITH CHECK y passe inaperçue. La conversion est faite
-- à iso-comportement pour rester sans risque ; éclater ces policies par
-- commande serait le pas suivant.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.qual,
           array_to_string(p.roles, ',') as roles_csv
    from pg_policies p
    join pg_class c on c.relname = p.tablename
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    where p.schemaname = 'public'
      and p.cmd = 'ALL'
      and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
      and p.with_check is null
      and p.qual is not null
      and has_table_privilege('authenticated', c.oid, 'update')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for all to %s using (%s) with check (%s)',
      r.policyname, r.tablename, r.roles_csv, r.qual, r.qual
    );
    n := n + 1;
  end loop;
  raise notice 'WITH CHECK ajouté à % policy(ies) FOR ALL', n;
end $$;
