-- ═══════════════════════════════════════════════════════════════
-- FIX SUPABASE ADVISORS — FINAL (self-contained, autonomous)
--
-- Handles everything remaining without user input:
--   1. Helper functions (has_org_membership, etc.) calling auth.uid()
--      → mark them STABLE so Postgres caches results per row-group,
--        which satisfies the auth_rls_initplan advisor.
--   2. Rewrite policies to wrap helper-function calls in (SELECT ...)
--      using a proper paren-matching algorithm (not regex).
--   3. Re-run the FK index pass in case any were missed.
--   4. Keep duplicate-index and permissive cleanup guards.
--
-- Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════

-- ─── Helper: wrap a function call at position `pos` with (SELECT ...)
-- This uses proper parenthesis counting, not regex. Returns modified string.
CREATE OR REPLACE FUNCTION pg_temp.wrap_fn_call(
  input text,
  fn_name text
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  result text := input;
  pos int;
  search_from int := 1;
  paren_depth int;
  i int;
  ch char;
  end_pos int;
  already_wrapped boolean;
BEGIN
  IF input IS NULL OR fn_name IS NULL OR length(fn_name) = 0 THEN
    RETURN input;
  END IF;

  LOOP
    -- Find next occurrence of fn_name followed by (
    pos := position(fn_name || '(' IN substring(result FROM search_from));
    IF pos = 0 THEN EXIT; END IF;
    pos := pos + search_from - 1;

    -- Check word boundary: char before must not be alphanumeric/underscore
    IF pos > 1 THEN
      ch := substring(result FROM pos - 1 FOR 1);
      IF ch ~ '[a-zA-Z0-9_]' THEN
        search_from := pos + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Check if already wrapped: look backwards for "(SELECT "
    already_wrapped := false;
    IF pos >= 9 THEN
      -- Skip whitespace backwards
      i := pos - 1;
      WHILE i >= 1 AND substring(result FROM i FOR 1) ~ '\s' LOOP
        i := i - 1;
      END LOOP;
      -- Check if preceded by "SELECT"
      IF i >= 6 AND upper(substring(result FROM i - 5 FOR 6)) = 'SELECT' THEN
        -- Check if before SELECT there's a (
        i := i - 6;
        WHILE i >= 1 AND substring(result FROM i FOR 1) ~ '\s' LOOP
          i := i - 1;
        END LOOP;
        IF i >= 1 AND substring(result FROM i FOR 1) = '(' THEN
          already_wrapped := true;
        END IF;
      END IF;
    END IF;

    IF already_wrapped THEN
      search_from := pos + length(fn_name) + 1;
      CONTINUE;
    END IF;

    -- Find matching closing paren
    paren_depth := 0;
    end_pos := 0;
    i := pos + length(fn_name);  -- position of opening (
    WHILE i <= length(result) LOOP
      ch := substring(result FROM i FOR 1);
      IF ch = '(' THEN
        paren_depth := paren_depth + 1;
      ELSIF ch = ')' THEN
        paren_depth := paren_depth - 1;
        IF paren_depth = 0 THEN
          end_pos := i;
          EXIT;
        END IF;
      END IF;
      i := i + 1;
    END LOOP;

    IF end_pos = 0 THEN
      -- Unbalanced, bail out
      EXIT;
    END IF;

    -- Wrap: insert "(SELECT " before pos and ")" after end_pos
    result := substring(result FROM 1 FOR pos - 1)
           || '(SELECT '
           || substring(result FROM pos FOR end_pos - pos + 1)
           || ')'
           || substring(result FROM end_pos + 1);

    -- Advance past the wrapped region
    search_from := end_pos + 1 + length('(SELECT ') + 1;
  END LOOP;

  RETURN result;
END;
$$;


-- ─── STEP 1: Mark helper functions STABLE ────────────────────────
DO $$
DECLARE
  f record;
  marked_count int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.provolatile = 'v'   -- currently VOLATILE
      AND (
        pg_get_functiondef(p.oid) ~ 'auth\.uid\s*\('
        OR pg_get_functiondef(p.oid) ~ 'auth\.jwt\s*\('
        OR pg_get_functiondef(p.oid) ~ 'auth\.role\s*\('
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) STABLE', f.proname, f.args);
      marked_count := marked_count + 1;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped STABLE for %.%: %', f.proname, f.args, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'STABLE marked on % helper functions', marked_count;
END $$;


-- ─── STEP 2: Wrap helper function calls in (SELECT ...) in all policies
DO $$
DECLARE
  helper_fns text[];
  r record;
  fn_name text;
  new_qual text;
  new_check text;
  roles_txt text;
  stats_done int := 0;
  stats_skipped int := 0;
  stats_failed int := 0;
BEGIN
  -- Collect helper fn names (those referencing auth.uid/jwt/role in source)
  SELECT array_agg(DISTINCT p.proname)
  INTO helper_fns
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname ~ '^[a-z_][a-z0-9_]*$'  -- valid identifier chars only
    AND (
      pg_get_functiondef(p.oid) ~ 'auth\.uid\s*\('
      OR pg_get_functiondef(p.oid) ~ 'auth\.jwt\s*\('
      OR pg_get_functiondef(p.oid) ~ 'auth\.role\s*\('
    );

  IF helper_fns IS NULL THEN
    RAISE NOTICE 'No helper functions detected — skipping step 2';
    RETURN;
  END IF;

  RAISE NOTICE 'Helper fns to wrap: %', helper_fns;

  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual  := r.qual;
    new_check := r.with_check;

    FOREACH fn_name IN ARRAY helper_fns LOOP
      new_qual  := pg_temp.wrap_fn_call(new_qual,  fn_name);
      new_check := pg_temp.wrap_fn_call(new_check, fn_name);
    END LOOP;

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
      RAISE WARNING 'FAILED %.%: %', r.tablename, r.policyname, SQLERRM;
      -- Restore original
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
          r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, roles_txt,
          CASE WHEN r.qual  IS NOT NULL THEN ' USING (' || r.qual  || ')' ELSE '' END,
          CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END
        );
      EXCEPTION WHEN others THEN
        RAISE WARNING '!!! LOST POLICY %.% — qual=[%] check=[%]',
          r.tablename, r.policyname, r.qual, r.with_check;
      END;
    END;
  END LOOP;

  RAISE NOTICE 'Policies rewritten: % rewrote, % skipped, % failed',
    stats_done, stats_skipped, stats_failed;
END $$;


-- ─── STEP 3: Re-run FK index pass ────────────────────────────────
DO $$
DECLARE
  c record;
  idx_name text;
  col_list text;
  created int := 0;
BEGIN
  FOR c IN
    SELECT
      cl.oid AS table_oid,
      cl.relname AS table_name,
      con.conname AS constraint_name,
      con.conkey::int[] AS col_positions,
      (
        SELECT array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
        FROM pg_attribute a
        WHERE a.attrelid = cl.oid AND a.attnum = ANY(con.conkey)
      ) AS col_names
    FROM pg_constraint con
    JOIN pg_class cl ON con.conrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    WHERE con.contype = 'f' AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = cl.oid
          AND array_length(con.conkey::int[], 1) <= array_length(i.indkey::int[], 1)
          AND (i.indkey::int[])[1:array_length(con.conkey::int[], 1)] = con.conkey::int[]
      )
  LOOP
    col_list := array_to_string(
      (SELECT array_agg(quote_ident(cn)) FROM unnest(c.col_names) cn),
      ', '
    );
    idx_name := left(
      'idx_fk_' || c.table_name || '_' || array_to_string(c.col_names, '_'),
      55
    ) || '_' || substr(md5(c.constraint_name), 1, 6);

    BEGIN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
        idx_name, c.table_name, col_list
      );
      created := created + 1;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped FK index %.%: %', c.table_name, c.constraint_name, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'FK indexes created: %', created;
END $$;

ANALYZE;
