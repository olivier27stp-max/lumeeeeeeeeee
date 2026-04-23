-- ═══════════════════════════════════════════════════════════════
-- DIAGNOSTIC: liste tous les advisors Supabase restants
-- Copier-coller dans SQL Editor → Run
-- Renvoie une table unique avec catégorie + cible + détail
-- ═══════════════════════════════════════════════════════════════

WITH

-- 1. Policies qui ont encore auth.uid() non-wrappé
rls_initplan AS (
  SELECT
    'auth_rls_initplan' AS category,
    tablename::text AS target,
    policyname || ' (' || cmd || ')' AS detail
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (qual ~ '(?<!select )auth\.uid\(\)' AND qual !~ 'select auth\.uid')
      OR (with_check ~ '(?<!select )auth\.uid\(\)' AND with_check !~ 'select auth\.uid')
    )
),

-- 2. Fonctions sans search_path pinned
fn_search_path AS (
  SELECT
    'function_search_path_mutable' AS category,
    (n.nspname || '.' || p.proname) AS target,
    pg_get_function_identity_arguments(p.oid) AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND (
      p.proconfig IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
      )
    )
),

-- 3. FK sans index couvrant
fk_unindexed AS (
  SELECT
    'unindexed_foreign_key' AS category,
    cl.relname::text AS target,
    con.conname::text AS detail
  FROM pg_constraint con
  JOIN pg_class cl ON con.conrelid = cl.oid
  JOIN pg_namespace n ON cl.relnamespace = n.oid
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = con.conrelid
        AND (i.indkey::int[])[1:array_length(con.conkey, 1)] = con.conkey::int[]
    )
),

-- 4. Tables publiques sans RLS
rls_off AS (
  SELECT
    'rls_disabled_in_public' AS category,
    cl.relname::text AS target,
    'RLS is OFF' AS detail
  FROM pg_class cl
  JOIN pg_namespace n ON cl.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND cl.relkind = 'r'
    AND cl.relrowsecurity = false
    AND cl.relname NOT IN ('schema_migrations','supabase_migrations')
),

-- 5. Extensions dans public
ext_public AS (
  SELECT
    'extension_in_public' AS category,
    e.extname::text AS target,
    'installed in public schema' AS detail
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
  WHERE n.nspname = 'public'
),

-- 6. Index dupliqués (mêmes colonnes, même filtre)
dup_idx AS (
  SELECT
    'duplicate_index' AS category,
    ca.relname::text AS target,
    (a.indexrelid::regclass::text || ' ≡ ' || b.indexrelid::regclass::text) AS detail
  FROM pg_index a
  JOIN pg_index b
    ON a.indrelid = b.indrelid
   AND a.indexrelid < b.indexrelid
   AND a.indkey::int[] = b.indkey::int[]
   AND COALESCE(pg_get_expr(a.indpred, a.indrelid), '') = COALESCE(pg_get_expr(b.indpred, b.indrelid), '')
   AND a.indisunique = b.indisunique
  JOIN pg_class ca ON ca.oid = a.indrelid
  JOIN pg_namespace na ON ca.relnamespace = na.oid
  WHERE na.nspname = 'public'
),

-- 7. Multiple permissive policies sur même (role, cmd, table)
multi_permissive AS (
  SELECT
    'multiple_permissive_policies' AS category,
    tablename::text AS target,
    (cmd || ' → ' || string_agg(policyname, ', ' ORDER BY policyname)) AS detail
  FROM pg_policies
  WHERE schemaname = 'public'
    AND permissive = 'PERMISSIVE'
  GROUP BY tablename, cmd, roles
  HAVING count(*) > 1
)

SELECT category, target, detail FROM rls_initplan
UNION ALL SELECT category, target, detail FROM fn_search_path
UNION ALL SELECT category, target, detail FROM fk_unindexed
UNION ALL SELECT category, target, detail FROM rls_off
UNION ALL SELECT category, target, detail FROM ext_public
UNION ALL SELECT category, target, detail FROM dup_idx
UNION ALL SELECT category, target, detail FROM multi_permissive
ORDER BY category, target;
