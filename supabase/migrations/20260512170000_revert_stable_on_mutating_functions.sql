-- Revert STABLE volatility on functions that perform DML.
-- The 20260626250000_fix_advisors_final.sql migration over-marked these
-- because it didn't exclude functions doing INSERT/UPDATE/DELETE.
-- Postgres rejects DML in non-volatile functions with:
--   "INSERT is not allowed in a non-volatile function"
-- Production-breaking: blocks creation of clients, leads, quotes, invoices,
-- jobs, deals, etc. — every page that calls a `create_*` RPC fails.

DO $$
DECLARE
  f record;
  reverted_count int := 0;
  skipped_count int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.provolatile = 's'
      AND (
        pg_get_functiondef(p.oid) ILIKE '%insert into%'
        OR pg_get_functiondef(p.oid) ~* '\mupdate\s+\w+\s+set\M'
        OR pg_get_functiondef(p.oid) ILIKE '%delete from%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) VOLATILE', f.proname, f.args);
      reverted_count := reverted_count + 1;
      RAISE NOTICE 'Reverted: %(%)', f.proname, f.args;
    EXCEPTION WHEN others THEN
      skipped_count := skipped_count + 1;
      RAISE WARNING 'Skipped %(%): %', f.proname, f.args, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Total reverted: %, skipped: %', reverted_count, skipped_count;
END $$;
