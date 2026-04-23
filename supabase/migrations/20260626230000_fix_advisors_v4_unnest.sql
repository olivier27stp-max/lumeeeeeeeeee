-- ═══════════════════════════════════════════════════════════════
-- FIX SUPABASE ADVISORS — V4 (unnest nested SELECTs)
-- Root cause found: V1+V2 got re-run, stacking nested SELECTs like
--   ( SELECT ( SELECT ( SELECT auth.uid() AS uid) AS uid) AS uid)
-- Supabase advisor still flags these because the inner auth.uid()
-- is "hidden" under redundant layers.
--
-- V4 strategy:
--   1. Strip ALL surrounding ( SELECT … AS alias ) wrappers around
--      auth.uid/jwt/role down to the bare call
--   2. Rewrap exactly once as (select auth.xxx())
--   3. Loop until the string stabilizes (handles arbitrarily deep nesting)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.collapse_auth_wrappers(input text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  prev text;
  cur text := input;
BEGIN
  IF cur IS NULL THEN
    RETURN NULL;
  END IF;

  -- Collapse any ( SELECT ... auth.uid() AS uid ... ) down to auth.uid()
  -- by iteratively removing the outermost SELECT-wrapper that immediately
  -- contains a nested auth-wrapper or a bare auth call.
  LOOP
    prev := cur;

    -- Pattern 1: ( SELECT ( ... auth.xxx() ... ) AS alias )  →  ( ... auth.xxx() ... )
    -- i.e. strip a useless outer SELECT that just passes through an expression
    cur := regexp_replace(
      cur,
      '\(\s*SELECT\s+(\(\s*SELECT[^)]*auth\.(?:uid|jwt|role)\s*\(\s*\)[^)]*\))\s+AS\s+\w+\s*\)',
      '\1',
      'gi'
    );

    -- Pattern 2: ( SELECT auth.xxx() AS alias )  →  (SELECT auth.xxx())
    -- normalize the innermost wrapped form
    cur := regexp_replace(
      cur,
      '\(\s*SELECT\s+auth\.(uid|jwt|role)\s*\(\s*\)\s+AS\s+\w+\s*\)',
      '(SELECT auth.\1())',
      'gi'
    );

    EXIT WHEN cur = prev;
  END LOOP;

  -- Final cleanup: any bare auth.xxx() → (SELECT auth.xxx())
  -- (only wraps calls that aren't already inside a SELECT — which at this
  -- point should be rare because step 1+2 handled the wrapped ones)
  -- We use a placeholder dance to avoid double-wrapping.
  cur := regexp_replace(cur, '\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)',  '__WUID__',  'gi');
  cur := regexp_replace(cur, '\(\s*SELECT\s+auth\.jwt\s*\(\s*\)\s*\)',  '__WJWT__',  'gi');
  cur := regexp_replace(cur, '\(\s*SELECT\s+auth\.role\s*\(\s*\)\s*\)', '__WROLE__', 'gi');
  cur := regexp_replace(cur, 'auth\.uid\s*\(\s*\)',  '(SELECT auth.uid())',  'gi');
  cur := regexp_replace(cur, 'auth\.jwt\s*\(\s*\)',  '(SELECT auth.jwt())',  'gi');
  cur := regexp_replace(cur, 'auth\.role\s*\(\s*\)', '(SELECT auth.role())', 'gi');
  cur := replace(cur, '__WUID__',  '(SELECT auth.uid())');
  cur := replace(cur, '__WJWT__',  '(SELECT auth.jwt())');
  cur := replace(cur, '__WROLE__', '(SELECT auth.role())');

  RETURN cur;
END;
$$;


DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  roles_txt text;
  stats_done int := 0;
  stats_skipped int := 0;
  stats_failed int := 0;
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
    new_qual  := pg_temp.collapse_auth_wrappers(r.qual);
    new_check := pg_temp.collapse_auth_wrappers(r.with_check);

    IF new_qual IS NOT DISTINCT FROM r.qual
       AND new_check IS NOT DISTINCT FROM r.with_check THEN
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
      RAISE WARNING 'FAILED %.%: % (cmd=%)',
        r.tablename, r.policyname, SQLERRM, r.cmd;
      -- Restore original
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
          r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, roles_txt,
          CASE WHEN r.qual  IS NOT NULL THEN ' USING (' || r.qual  || ')' ELSE '' END,
          CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END
        );
      EXCEPTION WHEN others THEN
        RAISE WARNING '!!! LOST POLICY %.% — original qual=[%]',
          r.tablename, r.policyname, r.qual;
      END;
    END;
  END LOOP;

  RAISE NOTICE 'V4 summary: % rewrote, % already-ok, % failed',
    stats_done, stats_skipped, stats_failed;
END $$;

ANALYZE;
