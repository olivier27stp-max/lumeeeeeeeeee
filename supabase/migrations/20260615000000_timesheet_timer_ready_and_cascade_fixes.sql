-- ============================================================
-- Migration: Timer-ready time_entries + cascade & isolation fixes
-- Date: 2026-04-08
-- ============================================================

BEGIN;

-- ============================================================
-- 1. TIME_ENTRIES — Migrate to timestamptz for real punch timer
-- ============================================================

-- 1a. Add new timestamptz columns
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS punch_in_at  timestamptz,
  ADD COLUMN IF NOT EXISTS punch_out_at timestamptz;

-- 1b. Backfill from existing time + date columns
UPDATE public.time_entries
SET punch_in_at  = (date + punch_in)  AT TIME ZONE 'America/Toronto',
    punch_out_at = CASE WHEN punch_out IS NOT NULL
                        THEN (date + punch_out) AT TIME ZONE 'America/Toronto'
                        ELSE NULL END
WHERE punch_in_at IS NULL;

-- 1c. Add status column for active timer tracking
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('active', 'paused', 'completed'));

-- 1d. Add approval columns
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- 1e. Unique constraint: only one active session per employee
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_active
  ON public.time_entries (employee_id)
  WHERE status = 'active';

-- 1f. Mark backfilled entries as completed (they already have punch_in/out)
UPDATE public.time_entries
SET status = 'completed'
WHERE punch_out IS NOT NULL AND status = 'active';

-- 1g. Index for fast org+status lookups
CREATE INDEX IF NOT EXISTS idx_time_entries_org_status
  ON public.time_entries(org_id, status);

CREATE INDEX IF NOT EXISTS idx_time_entries_punch_in_at
  ON public.time_entries(org_id, punch_in_at DESC);

-- ============================================================
-- 2. CASCADE FIXES — Add missing ON DELETE CASCADE where needed
-- ============================================================

-- 2a. schedule_events.job_id should cascade (may already exist)
DO $$
BEGIN
  -- Drop old FK if it exists without cascade
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'schedule_events_job_id_fkey'
      AND table_name = 'schedule_events'
  ) THEN
    ALTER TABLE public.schedule_events DROP CONSTRAINT schedule_events_job_id_fkey;
  END IF;

  -- Re-add with CASCADE
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedule_events' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE public.schedule_events
      ADD CONSTRAINT schedule_events_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2b. job_line_items.job_id should cascade
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'job_line_items_job_id_fkey'
      AND table_name = 'job_line_items'
  ) THEN
    ALTER TABLE public.job_line_items DROP CONSTRAINT job_line_items_job_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_line_items' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE public.job_line_items
      ADD CONSTRAINT job_line_items_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2c. pipeline_deals.lead_id should cascade
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pipeline_deals_lead_id_fkey'
      AND table_name = 'pipeline_deals'
  ) THEN
    ALTER TABLE public.pipeline_deals DROP CONSTRAINT pipeline_deals_lead_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_deals' AND column_name = 'lead_id'
  ) THEN
    ALTER TABLE public.pipeline_deals
      ADD CONSTRAINT pipeline_deals_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 3. CLIENT DELETE — Change invoice FK from RESTRICT to CASCADE
--    so delete_client_cascade RPC doesn't need manual cleanup
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_client_id_fkey'
      AND table_name = 'invoices'
  ) THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_client_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 4. JOBS.CLIENT_ID — Change from SET NULL to CASCADE
--    so deleting a client hard-deletes its jobs too
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_client_id_fkey'
      AND table_name = 'jobs'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_client_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 5. AVAILABILITY OVERLAP PREVENTION
--    Prevent overlapping weekly availability for the same team+weekday
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_availability_overlap()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.team_availability
    WHERE team_id = NEW.team_id
      AND weekday = NEW.weekday
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND deleted_at IS NULL
      AND NEW.start_minute < end_minute
      AND NEW.end_minute > start_minute
  ) THEN
    RAISE EXCEPTION 'Availability overlap detected for team % on weekday %', NEW.team_id, NEW.weekday;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_availability_overlap ON public.team_availability;
CREATE TRIGGER trg_check_availability_overlap
  BEFORE INSERT OR UPDATE ON public.team_availability
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.check_availability_overlap();

-- ============================================================
-- 6. RPC: Hard delete a job with full cascade
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_job_cascade(
  p_org_id uuid,
  p_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_events int := 0;
  v_line_items int := 0;
BEGIN
  -- Unlink quotes (don't delete them — they belong to the client)
  UPDATE public.quotes SET job_id = NULL WHERE job_id = p_job_id AND org_id = p_org_id;

  -- Delete schedule events
  DELETE FROM public.schedule_events WHERE job_id = p_job_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  -- Delete line items
  DELETE FROM public.job_line_items WHERE job_id = p_job_id;
  GET DIAGNOSTICS v_line_items = ROW_COUNT;

  -- Delete the job itself
  DELETE FROM public.jobs WHERE id = p_job_id AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'job', p_job_id,
    'schedule_events', v_events,
    'line_items', v_line_items
  );
END;
$$;

-- ============================================================
-- 7. RPC: Hard delete a lead with full cascade
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_lead_cascade(
  p_org_id uuid,
  p_lead_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_deals int := 0;
BEGIN
  -- Unlink quotes
  UPDATE public.quotes SET lead_id = NULL WHERE lead_id = p_lead_id AND org_id = p_org_id;

  -- Unlink jobs
  UPDATE public.jobs SET lead_id = NULL WHERE lead_id = p_lead_id AND org_id = p_org_id;

  -- Delete pipeline deals
  DELETE FROM public.pipeline_deals WHERE lead_id = p_lead_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_deals = ROW_COUNT;

  -- Delete tasks if table exists
  BEGIN
    DELETE FROM public.tasks WHERE lead_id = p_lead_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Delete lead_lists entries if table exists
  BEGIN
    DELETE FROM public.lead_lists WHERE lead_id = p_lead_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Delete job_intents if table exists
  BEGIN
    DELETE FROM public.job_intents WHERE lead_id = p_lead_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Delete the lead itself
  DELETE FROM public.leads WHERE id = p_lead_id AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'lead', p_lead_id,
    'pipeline_deals', v_deals
  );
END;
$$;

-- ============================================================
-- 8. RPC: Hard delete a quote with full cascade
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_quote_cascade(
  p_org_id uuid,
  p_quote_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- DB ON DELETE CASCADE handles: quote_line_items, quote_sections,
  -- quote_send_log, quote_status_history, quote_attachments
  DELETE FROM public.quotes WHERE id = p_quote_id AND org_id = p_org_id;
END;
$$;

-- ============================================================
-- 9. RPC: Hard delete an invoice with full cascade
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_invoice_cascade(
  p_org_id uuid,
  p_invoice_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Delete payments linked to this invoice
  DELETE FROM public.payments WHERE invoice_id = p_invoice_id AND org_id = p_org_id;

  -- DB ON DELETE CASCADE handles: invoice_items
  DELETE FROM public.invoices WHERE id = p_invoice_id AND org_id = p_org_id;
END;
$$;

COMMIT;
