-- ═══════════════════════════════════════════════════════════════
-- FIX SUPABASE ADVISORS — V2 (targeted)
-- After v1 migration, 816 advisors remained:
--   • 513× auth_rls_initplan           (policies w/ bare auth.uid())
--   • 300× unindexed_foreign_key
--   •   2× multiple_permissive_policies
--   •   1× duplicate_index
--
-- V1 had a regex guard that over-filtered. V2 rewrites every policy
-- that contains a bare auth.* call, period — regardless of existing
-- wrapping. We rebuild each affected policy via CREATE OR REPLACE
-- semantics (drop + create in same transaction with a savepoint).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. auth_rls_initplan — wrap every auth.uid() / auth.jwt() / auth.role()
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  roles_txt text;
  cmd_txt text;
  has_auth_call boolean;
BEGIN
  FOR r IN
    SELECT
      schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual  := r.qual;
    new_check := r.with_check;
    has_auth_call := false;

    -- Detect bare auth.* calls (not already inside a SELECT subquery)
    -- Simple heuristic: if string contains auth.xxx() NOT preceded by "select "
    IF new_qual IS NOT NULL AND new_qual ~ 'auth\.(uid|jwt|role)\s*\(\s*\)' THEN
      -- Count bare occurrences vs wrapped occurrences
      IF (regexp_count(new_qual, 'auth\.(uid|jwt|role)\s*\(\s*\)')
          > regexp_count(new_qual, '\(\s*select\s+auth\.(uid|jwt|role)\s*\(\s*\)\s*\)')) THEN
        has_auth_call := true;
      END IF;
    END IF;
    IF new_check IS NOT NULL AND new_check ~ 'auth\.(uid|jwt|role)\s*\(\s*\)' THEN
      IF (regexp_count(new_check, 'auth\.(uid|jwt|role)\s*\(\s*\)')
          > regexp_count(new_check, '\(\s*select\s+auth\.(uid|jwt|role)\s*\(\s*\)\s*\)')) THEN
        has_auth_call := true;
      END IF;
    END IF;

    IF NOT has_auth_call THEN
      CONTINUE;
    END IF;

    -- Strategy: temporarily replace already-wrapped patterns with a
    -- placeholder, then wrap all remaining bare calls, then restore.
    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, '\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)', '__WRAPPED_UID__', 'gi');
      new_qual := regexp_replace(new_qual, '\(\s*select\s+auth\.jwt\s*\(\s*\)\s*\)', '__WRAPPED_JWT__', 'gi');
      new_qual := regexp_replace(new_qual, '\(\s*select\s+auth\.role\s*\(\s*\)\s*\)', '__WRAPPED_ROLE__', 'gi');
      new_qual := regexp_replace(new_qual, 'auth\.uid\s*\(\s*\)',  '(select auth.uid())',  'g');
      new_qual := regexp_replace(new_qual, 'auth\.jwt\s*\(\s*\)',  '(select auth.jwt())',  'g');
      new_qual := regexp_replace(new_qual, 'auth\.role\s*\(\s*\)', '(select auth.role())', 'g');
      new_qual := replace(new_qual, '__WRAPPED_UID__',  '(select auth.uid())');
      new_qual := replace(new_qual, '__WRAPPED_JWT__',  '(select auth.jwt())');
      new_qual := replace(new_qual, '__WRAPPED_ROLE__', '(select auth.role())');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)', '__WRAPPED_UID__', 'gi');
      new_check := regexp_replace(new_check, '\(\s*select\s+auth\.jwt\s*\(\s*\)\s*\)', '__WRAPPED_JWT__', 'gi');
      new_check := regexp_replace(new_check, '\(\s*select\s+auth\.role\s*\(\s*\)\s*\)', '__WRAPPED_ROLE__', 'gi');
      new_check := regexp_replace(new_check, 'auth\.uid\s*\(\s*\)',  '(select auth.uid())',  'g');
      new_check := regexp_replace(new_check, 'auth\.jwt\s*\(\s*\)',  '(select auth.jwt())',  'g');
      new_check := regexp_replace(new_check, 'auth\.role\s*\(\s*\)', '(select auth.role())', 'g');
      new_check := replace(new_check, '__WRAPPED_UID__',  '(select auth.uid())');
      new_check := replace(new_check, '__WRAPPED_JWT__',  '(select auth.jwt())');
      new_check := replace(new_check, '__WRAPPED_ROLE__', '(select auth.role())');
    END IF;

    -- No change → skip (idempotent)
    IF new_qual IS NOT DISTINCT FROM r.qual
       AND new_check IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;

    roles_txt := array_to_string(
      (SELECT array_agg(quote_ident(role_name)) FROM unnest(r.roles) role_name),
      ', '
    );
    cmd_txt := CASE r.cmd
                 WHEN 'ALL' THEN 'ALL'
                 WHEN 'SELECT' THEN 'SELECT'
                 WHEN 'INSERT' THEN 'INSERT'
                 WHEN 'UPDATE' THEN 'UPDATE'
                 WHEN 'DELETE' THEN 'DELETE'
                 ELSE r.cmd
               END;

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                     r.policyname, r.schemaname, r.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
        r.policyname,
        r.schemaname,
        r.tablename,
        r.permissive,
        cmd_txt,
        roles_txt,
        CASE WHEN new_qual IS NOT NULL THEN ' USING (' || new_qual || ')' ELSE '' END,
        CASE WHEN new_check IS NOT NULL THEN ' WITH CHECK (' || new_check || ')' ELSE '' END
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped %.%.%: %',
        r.schemaname, r.tablename, r.policyname, SQLERRM;
      -- Attempt to re-create the original policy to avoid losing it
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
          r.policyname, r.schemaname, r.tablename, r.permissive, cmd_txt, roles_txt,
          CASE WHEN r.qual IS NOT NULL THEN ' USING (' || r.qual || ')' ELSE '' END,
          CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END
        );
      EXCEPTION WHEN others THEN
        RAISE WARNING 'CRITICAL: policy %.%.% lost during rewrite: %',
          r.schemaname, r.tablename, r.policyname, SQLERRM;
      END;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 2. unindexed_foreign_key — aggressive coverage (single-col FK only)
-- ─────────────────────────────────────────────────────────────────
-- V1 used a strict "leading keys" check. V2 uses the same predicate as
-- the Supabase advisor itself: any index that begins with the FK column
-- array counts as coverage. If no index starts with those columns, we
-- add one. Composite FKs are supported; column order matches the FK.
DO $$
DECLARE
  c record;
  idx_name text;
  col_list text;
  has_coverage boolean;
BEGIN
  FOR c IN
    SELECT
      cl.relname AS table_name,
      cl.oid AS table_oid,
      con.conname AS constraint_name,
      con.conkey AS col_positions,
      array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) AS col_names
    FROM pg_constraint con
    JOIN pg_class cl ON con.conrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
    GROUP BY cl.relname, cl.oid, con.conname, con.conkey
  LOOP
    -- Coverage check: does any index's indkey start with col_positions?
    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = c.table_oid
        AND array_length(c.col_positions::int[], 1) <= array_length(i.indkey::int[], 1)
        AND (i.indkey::int[])[1:array_length(c.col_positions::int[], 1)]
            = c.col_positions::int[]
    ) INTO has_coverage;

    IF has_coverage THEN
      CONTINUE;
    END IF;

    col_list := array_to_string(
      (SELECT array_agg(quote_ident(cn)) FROM unnest(c.col_names) cn),
      ', '
    );
    idx_name := left('idx_fk_' || c.table_name || '_' || array_to_string(c.col_names, '_'), 63);

    BEGIN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
        idx_name, c.table_name, col_list
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped FK index on %.%: %',
        c.table_name, c.constraint_name, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 3. duplicate_index — drop the 1 remaining duplicate
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  d record;
BEGIN
  FOR d IN
    SELECT
      a.indexrelid::regclass::text AS keep_idx,
      b.indexrelid AS drop_oid,
      b.indexrelid::regclass::text AS drop_idx
    FROM pg_index a
    JOIN pg_index b
      ON a.indrelid = b.indrelid
     AND a.indexrelid < b.indexrelid
     AND a.indkey::int[] = b.indkey::int[]
     AND COALESCE(pg_get_expr(a.indpred, a.indrelid), '') = COALESCE(pg_get_expr(b.indpred, b.indrelid), '')
     AND a.indisunique = b.indisunique
    JOIN pg_class ca ON ca.oid = a.indexrelid
    JOIN pg_class cb ON cb.oid = b.indexrelid
    JOIN pg_namespace na ON ca.relnamespace = na.oid
    WHERE na.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conindid = b.indexrelid
      )
  LOOP
    BEGIN
      EXECUTE 'DROP INDEX IF EXISTS ' || d.drop_idx;
      RAISE NOTICE 'Dropped duplicate index % (kept %)', d.drop_idx, d.keep_idx;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped dropping %: %', d.drop_idx, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 4. multiple_permissive_policies — informational only
-- ─────────────────────────────────────────────────────────────────
-- 2 remaining permissive duplicates exist. Consolidating them
-- automatically risks breaking business logic (admin-scoped vs owner-
-- scoped policies overlapping is intentional). We list them so you
-- can review manually — see diagnostics/check_advisors.sql.
-- This section is a no-op on purpose.

ANALYZE;
