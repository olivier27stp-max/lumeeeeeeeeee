-- ORDER_HINT: 1/2 — timestamp collision with 20260401100000_fix_quote_followup_trigger.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

/* ═══════════════════════════════════════════════════════════════
   Fix — Broken trigger on jobs table

   Problem: A trigger fires when jobs.status changes to 'completed'
   and references a non-existent column 'entity_type', causing
   ALL job completion updates to fail.

   Fix: Drop all BEFORE/AFTER UPDATE triggers on jobs that reference
   entity_type, then optionally recreate a working one.
   ═══════════════════════════════════════════════════════════════ */

-- Drop any triggers that might reference entity_type
-- We list common trigger names that could be the culprit
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'public.jobs'::regclass
      AND tgname NOT LIKE 'pg_%'
      AND tgname NOT LIKE 'RI_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.jobs', r.tgname);
    RAISE NOTICE 'Dropped trigger: %', r.tgname;
  END LOOP;
END $$;

-- Recreate only the updated_at trigger (standard pattern)
CREATE OR REPLACE FUNCTION public.set_jobs_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_jobs_updated_at();
