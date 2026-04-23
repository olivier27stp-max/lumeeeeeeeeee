-- ═══════════════════════════════════════════════════════════════
-- FIX SUPABASE ADVISORS — V3 (nuclear, no detection)
-- V2 had silent detection bugs. V3 takes a different approach:
-- rewrite EVERY policy in public that mentions auth.uid/jwt/role,
-- regardless of whether it looks wrapped or not. The placeholder
-- dance guarantees no double-wrapping.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  roles_txt text;
  orig_qual text;
  orig_check text;
  stats_done integer := 0;
  stats_skipped integer := 0;
  stats_failed integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual LIKE '%auth.uid%'
        OR qual LIKE '%auth.jwt%'
        OR qual LIKE '%auth.role%'
        OR with_check LIKE '%auth.uid%'
        OR with_check LIKE '%auth.jwt%'
        OR with_check LIKE '%auth.role%'
      )
  LOOP
    orig_qual  := r.qual;
    orig_check := r.with_check;
    new_qual   := r.qual;
    new_check  := r.with_check;

    -- Step 1: mark every already-wrapped pattern with placeholders
    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)',  '__WUID__',  'gi');
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+auth\.jwt\s*\(\s*\)\s*\)',  '__WJWT__',  'gi');
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+auth\.role\s*\(\s*\)\s*\)', '__WROLE__', 'gi');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)',  '__WUID__',  'gi');
      new_check := regexp_replace(new_check, '\(\s*SELECT\s+auth\.jwt\s*\(\s*\)\s*\)',  '__WJWT__',  'gi');
      new_check := regexp_replace(new_check, '\(\s*SELECT\s+auth\.role\s*\(\s*\)\s*\)', '__WROLE__', 'gi');
    END IF;

    -- Step 2: wrap every remaining bare call
    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, 'auth\.uid\s*\(\s*\)',  '(SELECT auth.uid())',  'gi');
      new_qual := regexp_replace(new_qual, 'auth\.jwt\s*\(\s*\)',  '(SELECT auth.jwt())',  'gi');
      new_qual := regexp_replace(new_qual, 'auth\.role\s*\(\s*\)', '(SELECT auth.role())', 'gi');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, 'auth\.uid\s*\(\s*\)',  '(SELECT auth.uid())',  'gi');
      new_check := regexp_replace(new_check, 'auth\.jwt\s*\(\s*\)',  '(SELECT auth.jwt())',  'gi');
      new_check := regexp_replace(new_check, 'auth\.role\s*\(\s*\)', '(SELECT auth.role())', 'gi');
    END IF;

    -- Step 3: restore placeholders
    IF new_qual IS NOT NULL THEN
      new_qual := replace(new_qual, '__WUID__',  '(SELECT auth.uid())');
      new_qual := replace(new_qual, '__WJWT__',  '(SELECT auth.jwt())');
      new_qual := replace(new_qual, '__WROLE__', '(SELECT auth.role())');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, '__WUID__',  '(SELECT auth.uid())');
      new_check := replace(new_check, '__WJWT__',  '(SELECT auth.jwt())');
      new_check := replace(new_check, '__WROLE__', '(SELECT auth.role())');
    END IF;

    -- Skip if already correctly wrapped (idempotent)
    IF new_qual IS NOT DISTINCT FROM orig_qual
       AND new_check IS NOT DISTINCT FROM orig_check THEN
      stats_skipped := stats_skipped + 1;
      CONTINUE;
    END IF;

    roles_txt := array_to_string(
      (SELECT array_agg(quote_ident(rn)) FROM unnest(r.roles) rn),
      ', '
    );

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                     r.policyname, r.schemaname, r.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
        r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, roles_txt,
        CASE WHEN new_qual  IS NOT NULL THEN ' USING (' || new_qual  || ')' ELSE '' END,
        CASE WHEN new_check IS NOT NULL THEN ' WITH CHECK (' || new_check || ')' ELSE '' END
      );
      stats_done := stats_done + 1;
    EXCEPTION WHEN others THEN
      stats_failed := stats_failed + 1;
      RAISE WARNING 'FAILED %.%.% (%): %',
        r.schemaname, r.tablename, r.policyname, SQLERRM, r.cmd;
      -- Restore original policy
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
          r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, roles_txt,
          CASE WHEN orig_qual  IS NOT NULL THEN ' USING (' || orig_qual  || ')' ELSE '' END,
          CASE WHEN orig_check IS NOT NULL THEN ' WITH CHECK (' || orig_check || ')' ELSE '' END
        );
      EXCEPTION WHEN others THEN
        RAISE WARNING '!!! LOST POLICY %.%.% — manual recovery needed: original qual=[%] check=[%]',
          r.schemaname, r.tablename, r.policyname, orig_qual, orig_check;
      END;
    END;
  END LOOP;

  RAISE NOTICE 'V3 summary: % rewrote, % already-ok, % failed',
    stats_done, stats_skipped, stats_failed;
END $$;

ANALYZE;
