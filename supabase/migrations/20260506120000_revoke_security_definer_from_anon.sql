-- Revoke EXECUTE on SECURITY DEFINER functions from PUBLIC + anon (and from
-- authenticated for trigger functions).
--
-- WHY: 196 SECURITY DEFINER functions in public schema were callable by anon
-- via /rest/v1/rpc/. Functions like anonymize_client, hard_delete_client,
-- delete_invoice_cascade ran with owner privileges without authentication —
-- cross-tenant attack surface. Postgres grants EXECUTE to PUBLIC by default,
-- and anon inherits that, so we must REVOKE FROM PUBLIC explicitly.
--
-- WHAT: For every SECURITY DEFINER function in `public`:
--   - REVOKE EXECUTE FROM PUBLIC
--   - REVOKE EXECUTE FROM anon
--   - If trigger function: also REVOKE FROM authenticated (only the trigger
--     runtime needs it, never client RPC).
--
-- VERIFIED 2026-05-06: 0 anon-exposed and 0 authenticated-exposed trigger fns.
--
-- REVERSAL: GRANT EXECUTE ON FUNCTION foo(args) TO authenticated;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      (pg_get_function_result(p.oid) = 'trigger') AS returns_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
      fn.schema_name, fn.func_name, fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon',
      fn.schema_name, fn.func_name, fn.args);
    IF fn.returns_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM authenticated',
        fn.schema_name, fn.func_name, fn.args);
    END IF;
  END LOOP;
END $$;
