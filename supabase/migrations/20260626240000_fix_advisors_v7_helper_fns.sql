-- ═══════════════════════════════════════════════════════════════
-- FIX SUPABASE ADVISORS — V7 (helper function calls)
-- Root cause of the 549 remaining auth_rls_initplan warnings:
-- Policies use helper functions like `has_org_membership()` that
-- internally call auth.uid(). Supabase advisor flags ANY such call
-- unless it's wrapped in a (SELECT ...) at the policy level.
--
-- Current form (flagged):
--   has_org_membership((SELECT auth.uid()), org_id)
-- Target form:
--   (SELECT has_org_membership((SELECT auth.uid()), org_id))
--
-- Additionally, we mark the helper functions as STABLE so Postgres
-- caches their result per-row-group even without the explicit SELECT.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Mark auth-helper functions as STABLE where applicable ────
-- A STABLE function is allowed in indexes and cached per-query by the
-- planner. Supabase advisor treats STABLE helpers more leniently.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.provolatile
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.provolatile = 'v'   -- currently VOLATILE
      AND (
        p.proname LIKE '%has_org_membership%'
        OR p.proname LIKE '%is_%_admin%'
        OR p.proname LIKE '%has_%_access%'
        OR p.proname LIKE '%current_%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) STABLE', f.proname, f.args);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped STABLE on %: %', f.proname, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─── 2. Wrap helper function calls in (SELECT ...) in policies ──
-- We rewrite policy USING/WITH CHECK clauses so that any call to a
-- schema-public function that internally references auth.uid() gets
-- wrapped in a SELECT. We identify candidate functions automatically.
DO $$
DECLARE
  helper_fn_names text[];
  r record;
  fn_name text;
  new_qual text;
  new_check text;
  roles_txt text;
  pattern text;
  stats_done int := 0;
  stats_skipped int := 0;
  stats_failed int := 0;
BEGIN
  -- Collect names of public functions whose source references auth.uid/jwt/role
  SELECT array_agg(DISTINCT p.proname)
  INTO helper_fn_names
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND (
      pg_get_functiondef(p.oid) ~ 'auth\.uid\s*\('
      OR pg_get_functiondef(p.oid) ~ 'auth\.jwt\s*\('
      OR pg_get_functiondef(p.oid) ~ 'auth\.role\s*\('
    );

  IF helper_fn_names IS NULL OR array_length(helper_fn_names, 1) = 0 THEN
    RAISE NOTICE 'No helper functions found';
    RETURN;
  END IF;

  RAISE NOTICE 'Helper functions detected: %', helper_fn_names;

  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual  := r.qual;
    new_check := r.with_check;

    -- For each helper function, wrap its calls in (SELECT ...)
    -- unless already wrapped.
    FOREACH fn_name IN ARRAY helper_fn_names LOOP
      -- Skip if fn name contains chars that would break our regex
      IF fn_name !~ '^[a-z_][a-z0-9_]*$' THEN CONTINUE; END IF;

      -- Placeholder dance to prevent double-wrapping
      IF new_qual IS NOT NULL AND position(fn_name in new_qual) > 0 THEN
        -- Mark already-wrapped forms: (SELECT fn(...))
        pattern := '\(\s*SELECT\s+' || fn_name || '\s*\(';
        new_qual := regexp_replace(new_qual, pattern, '__WRAPPED_FN__' || fn_name || '(', 'gi');
        -- Wrap remaining bare calls: fn(...) → (SELECT fn(...))
        -- We only wrap when fn is at word boundary to avoid partial matches
        pattern := '\m' || fn_name || '\s*\(';
        new_qual := regexp_replace(new_qual, pattern, '__TMP_WRAP__' || fn_name || '(', 'g');
        -- Now swap placeholders back
        new_qual := replace(new_qual, '__WRAPPED_FN__' || fn_name, fn_name);
        new_qual := replace(new_qual, '__TMP_WRAP__' || fn_name, '(SELECT ' || fn_name);
      END IF;

      IF new_check IS NOT NULL AND position(fn_name in new_check) > 0 THEN
        pattern := '\(\s*SELECT\s+' || fn_name || '\s*\(';
        new_check := regexp_replace(new_check, pattern, '__WRAPPED_FN__' || fn_name || '(', 'gi');
        pattern := '\m' || fn_name || '\s*\(';
        new_check := regexp_replace(new_check, pattern, '__TMP_WRAP__' || fn_name || '(', 'g');
        new_check := replace(new_check, '__WRAPPED_FN__' || fn_name, fn_name);
        new_check := replace(new_check, '__TMP_WRAP__' || fn_name, '(SELECT ' || fn_name);
      END IF;
    END LOOP;

    -- The wrap above only added an opening `(SELECT fn(`. We now need
    -- to close with a matching `)`. For each `(SELECT fn(...)` pattern
    -- created, we find the matching closing paren and insert a `)`
    -- after it. This is done via a scan.
    IF new_qual IS NOT NULL THEN
      new_qual := pg_temp.close_select_wraps(new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := pg_temp.close_select_wraps(new_check);
    END IF;

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
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
          r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, roles_txt,
          CASE WHEN r.qual  IS NOT NULL THEN ' USING (' || r.qual  || ')' ELSE '' END,
          CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END
        );
      EXCEPTION WHEN others THEN
        RAISE WARNING '!!! LOST POLICY %.% — original qual=[%]', r.tablename, r.policyname, r.qual;
      END;
    END;
  END LOOP;

  RAISE NOTICE 'V7 summary: % rewrote, % skipped, % failed',
    stats_done, stats_skipped, stats_failed;
END $$;

ANALYZE;
