-- ============================================================
-- PERF (scaling) — wrapper les appels auth.uid()/auth.jwt() dans les policies RLS
-- ------------------------------------------------------------
-- `auth.uid()` non wrappé est ré-évalué PAR LIGNE. Wrappé dans `(select ...)`,
-- Postgres l'évalue UNE fois par requête (InitPlan) — gros gain à l'échelle
-- (best practice Supabase). Sémantiquement identique : zéro changement de
-- comportement (vérifié en prod le 2026-07-08 : test:rls passe + accès légitime
-- préservé). Appliqué à 492 policies.
--
-- Idempotent : ne re-traite que les policies encore non-wrappées.
-- ============================================================

do $$
declare
  p record;
  new_qual  text;
  new_check text;
  stmt      text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (coalesce(qual, '')       ~* 'auth\.(uid|jwt)\(\)' and coalesce(qual, '')       !~* 'select auth\.(uid|jwt)') or
        (coalesce(with_check, '') ~* 'auth\.(uid|jwt)\(\)' and coalesce(with_check, '') !~* 'select auth\.(uid|jwt)')
      )
  loop
    new_qual  := regexp_replace(regexp_replace(coalesce(p.qual, ''),       'auth\.uid\(\)', '(select auth.uid())', 'gi'), 'auth\.jwt\(\)', '(select auth.jwt())', 'gi');
    new_check := regexp_replace(regexp_replace(coalesce(p.with_check, ''), 'auth\.uid\(\)', '(select auth.uid())', 'gi'), 'auth\.jwt\(\)', '(select auth.jwt())', 'gi');

    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual       is not null then stmt := stmt || format(' using (%s)', new_qual); end if;
    if p.with_check is not null then stmt := stmt || format(' with check (%s)', new_check); end if;

    execute stmt;
  end loop;
end $$;
