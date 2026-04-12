-- ============================================================================
-- Optimistic locking via version column
-- Prevents concurrent edit conflicts (last-write-wins → conflict detection)
-- ============================================================================

-- Add version column to main editable tables
ALTER TABLE IF EXISTS public.quotes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS public.jobs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS public.invoices ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS public.clients ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Auto-increment version on every update via trigger
CREATE OR REPLACE FUNCTION public.increment_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quotes_increment_version') THEN
    CREATE TRIGGER trg_quotes_increment_version BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_jobs_increment_version') THEN
    CREATE TRIGGER trg_jobs_increment_version BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_increment_version') THEN
    CREATE TRIGGER trg_invoices_increment_version BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clients_increment_version') THEN
    CREATE TRIGGER trg_clients_increment_version BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_leads_increment_version') THEN
    CREATE TRIGGER trg_leads_increment_version BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.increment_version();
  END IF;
END $$;
