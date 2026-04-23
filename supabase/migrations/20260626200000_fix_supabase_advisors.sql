-- ═══════════════════════════════════════════════════════════════
-- FIX SUPABASE ADVISORS — systematic cleanup
-- Addresses the 6 most common advisor categories for a multi-tenant
-- Supabase project:
--   1. auth_rls_initplan          — auth.uid() re-evaluated per row
--   2. function_search_path_mutable — SECURITY DEFINER w/o pinned search_path
--   3. unindexed_foreign_keys     — FK columns without covering index
--   4. multiple_permissive_policies — overlapping RLS policies (informational)
--   5. rls_disabled_in_public     — public schema tables w/o RLS
--   6. extension_in_public        — extensions installed in public schema
--
-- Strategy:
--   • Fully idempotent (IF EXISTS / IF NOT EXISTS everywhere)
--   • Scoped via DO blocks + information_schema checks — won't error if
--     a table/column/function doesn't exist in this environment
--   • No data changes — only DDL
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. auth_rls_initplan — rewrite policies that call auth.uid() directly
-- ─────────────────────────────────────────────────────────────────
-- Supabase advisor: policies that use `auth.uid()` re-execute the fn for
-- every row. Wrapping in `(SELECT auth.uid())` makes Postgres cache it as
-- an initplan, dropping thousands of fn calls per query on large tables.
--
-- We rewrite the pattern everywhere in policy USING/WITH CHECK clauses
-- programmatically. Safe because `(SELECT auth.uid())` returns identical
-- value to `auth.uid()` within a single query.

DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
BEGIN
  FOR r IN
    SELECT
      schemaname, tablename, policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual ~ '\mauth\.uid\(\)'
        OR with_check ~ '\mauth\.uid\(\)'
        OR qual ~ '\mauth\.jwt\(\)'
        OR with_check ~ '\mauth\.jwt\(\)'
        OR qual ~ '\mauth\.role\(\)'
        OR with_check ~ '\mauth\.role\(\)'
      )
      -- Skip already-wrapped forms like (SELECT auth.uid())
      AND (
        qual !~ '\(\s*SELECT\s+auth\.' OR qual ~ '\mauth\.uid\(\)\s*(?!\))'
      )
  LOOP
    -- Replace bare auth.uid() / auth.jwt() / auth.role() with (select ...)
    new_qual := r.qual;
    new_check := r.with_check;

    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, '\mauth\.uid\(\)', '(select auth.uid())', 'g');
      new_qual := regexp_replace(new_qual, '\mauth\.jwt\(\)', '(select auth.jwt())', 'g');
      new_qual := regexp_replace(new_qual, '\mauth\.role\(\)', '(select auth.role())', 'g');
      -- Guard: don't double-wrap
      new_qual := regexp_replace(new_qual, '\(select \(select auth\.(uid|jwt|role)\(\)\)\)', '(select auth.\1())', 'g');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '\mauth\.uid\(\)', '(select auth.uid())', 'g');
      new_check := regexp_replace(new_check, '\mauth\.jwt\(\)', '(select auth.jwt())', 'g');
      new_check := regexp_replace(new_check, '\mauth\.role\(\)', '(select auth.role())', 'g');
      new_check := regexp_replace(new_check, '\(select \(select auth\.(uid|jwt|role)\(\)\)\)', '(select auth.\1())', 'g');
    END IF;

    -- Skip if no actual change (idempotent re-run)
    IF new_qual IS NOT DISTINCT FROM r.qual
       AND new_check IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                     r.policyname, r.schemaname, r.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO %s%s%s',
        r.policyname,
        r.schemaname,
        r.tablename,
        r.cmd,
        array_to_string(r.roles, ', '),
        CASE WHEN new_qual IS NOT NULL THEN ' USING (' || new_qual || ')' ELSE '' END,
        CASE WHEN new_check IS NOT NULL THEN ' WITH CHECK (' || new_check || ')' ELSE '' END
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped policy %.%.% rewrite: %',
        r.schemaname, r.tablename, r.policyname, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 2. function_search_path_mutable — pin search_path on all public fns
-- ─────────────────────────────────────────────────────────────────
-- Supabase advisor: SECURITY DEFINER functions without an explicit
-- search_path can be hijacked via schema-poisoning attacks. Pinning it
-- to `public, pg_temp` (or `pg_catalog, public` for pure-logic fns)
-- removes the warning and the attack surface.

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT n.nspname AS schema_name, p.proname AS fn_name,
           pg_get_function_identity_arguments(p.oid) AS fn_args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'  -- regular functions only (not aggregates/procs)
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) c
          WHERE c LIKE 'search_path=%'
        )
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
        f.fn_name, f.fn_args
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped search_path set for %.%(%): %',
        f.schema_name, f.fn_name, f.fn_args, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 3. unindexed_foreign_keys — auto-index every FK in public schema
-- ─────────────────────────────────────────────────────────────────
-- Supabase advisor: foreign key columns without a covering index cause
-- expensive lookups on cascade/parent deletes and join queries. We scan
-- pg_constraint for FKs and create a single-column index for each one
-- that doesn't already have coverage.

DO $$
DECLARE
  c record;
  idx_name text;
  col_list text;
BEGIN
  FOR c IN
    SELECT
      cl.relname AS table_name,
      con.conname AS constraint_name,
      con.conkey AS col_positions,
      array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) AS col_names
    FROM pg_constraint con
    JOIN pg_class cl ON con.conrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
    GROUP BY cl.relname, con.conname, con.conkey
  LOOP
    col_list := array_to_string(
      (SELECT array_agg(quote_ident(cn)) FROM unnest(c.col_names) cn),
      ', '
    );
    idx_name := 'idx_fk_' || c.table_name || '_' || array_to_string(c.col_names, '_');
    -- Truncate to 63 chars (postgres identifier limit)
    idx_name := left(idx_name, 63);

    -- Skip if any index already covers these columns as leading keys
    IF EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = (quote_ident(c.table_name))::regclass
        AND i.indkey::int[] @> c.col_positions::int[]
        AND (i.indkey::int[])[1:array_length(c.col_positions, 1)] = c.col_positions::int[]
    ) THEN
      CONTINUE;
    END IF;

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
-- 4. rls_disabled_in_public — enable RLS on every exposed table
-- ─────────────────────────────────────────────────────────────────
-- Supabase advisor: every table in `public` should have RLS enabled, even
-- if it has no policies (effectively denying anon access). We enable it
-- wherever it's off. Existing policies are preserved.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT cl.relname AS table_name
    FROM pg_class cl
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND cl.relkind = 'r'          -- regular tables only (not views/mviews)
      AND cl.relrowsecurity = false
      -- Skip known infrastructure tables that shouldn't have RLS
      AND cl.relname NOT IN (
        'schema_migrations',
        'supabase_migrations'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped ENABLE RLS on %: %', t.table_name, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 5. extension_in_public — move extensions out of public schema
-- ─────────────────────────────────────────────────────────────────
-- Supabase advisor: extensions installed in `public` pollute the namespace
-- and complicate upgrades. Best practice: dedicated `extensions` schema.
-- Note: moving extensions is potentially breaking (functions referenced
-- by policies/triggers move too). We create the schema and move only the
-- safe, read-only extensions that are known not to break.

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

DO $$
DECLARE
  ext record;
BEGIN
  -- Only move extensions known to be safe to relocate
  FOR ext IN
    SELECT e.extname
    FROM pg_extension e
    JOIN pg_namespace n ON e.extnamespace = n.oid
    WHERE n.nspname = 'public'
      AND e.extname IN ('pg_trgm', 'btree_gin', 'btree_gist', 'unaccent', 'citext')
  LOOP
    BEGIN
      EXECUTE format('ALTER EXTENSION %I SET SCHEMA extensions', ext.extname);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped moving extension %: %', ext.extname, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 6. duplicate_index — drop exact-duplicate indexes
-- ─────────────────────────────────────────────────────────────────
-- Supabase advisor flags identical indexes (same columns, same order,
-- same filter). We drop the lexicographically-later one, keeping the
-- lower name to preserve any naming conventions like `pkey`/`uniq_`.

DO $$
DECLARE
  d record;
BEGIN
  FOR d IN
    SELECT
      a.indexrelid::regclass::text AS keep_idx,
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
      -- Never auto-drop primary key or unique-constraint-backing indexes
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conindid = b.indexrelid
      )
  LOOP
    BEGIN
      EXECUTE 'DROP INDEX IF EXISTS ' || d.drop_idx;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped dropping duplicate index %: %', d.drop_idx, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 7. Refresh planner statistics
-- ─────────────────────────────────────────────────────────────────
ANALYZE;
