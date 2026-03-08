-- Migration: 20260305240000_missing_tables_and_fixes.sql
-- Adds profiles, invoice_templates, org_billing_settings + RLS + triggers

BEGIN;

-- ============================================================
-- 1. profiles table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    text,
  avatar_url   text,
  company_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_select_own') THEN
    CREATE POLICY profiles_select_own ON public.profiles FOR SELECT
      USING (
        id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.memberships m1
          JOIN public.memberships m2 ON m1.org_id = m2.org_id
          WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_update_own') THEN
    CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE
      USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_insert_own') THEN
    CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT
      WITH CHECK (id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill existing users
INSERT INTO public.profiles (id, full_name, avatar_url)
SELECT u.id,
       COALESCE(u.raw_user_meta_data ->> 'full_name', ''),
       COALESCE(u.raw_user_meta_data ->> 'avatar_url', '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. invoice_templates table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL DEFAULT public.current_org_id(),
  name       text NOT NULL,
  content    jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_select_org') THEN
    CREATE POLICY invoice_templates_select_org ON public.invoice_templates FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_insert_org') THEN
    CREATE POLICY invoice_templates_insert_org ON public.invoice_templates FOR INSERT
      WITH CHECK (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_update_org') THEN
    CREATE POLICY invoice_templates_update_org ON public.invoice_templates FOR UPDATE
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_delete_org') THEN
    CREATE POLICY invoice_templates_delete_org ON public.invoice_templates FOR DELETE
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_templates_set_updated_at ON public.invoice_templates;
CREATE TRIGGER trg_invoice_templates_set_updated_at
  BEFORE UPDATE ON public.invoice_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. org_billing_settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_billing_settings (
  org_id       uuid PRIMARY KEY,
  company_name text,
  address      text,
  email        text,
  phone        text,
  logo_url     text,
  tax_number   text,
  footer_note  text,
  currency     text NOT NULL DEFAULT 'CAD',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_billing_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_billing_settings' AND policyname='org_billing_settings_select_org') THEN
    CREATE POLICY org_billing_settings_select_org ON public.org_billing_settings FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_billing_settings' AND policyname='org_billing_settings_insert_admin') THEN
    CREATE POLICY org_billing_settings_insert_admin ON public.org_billing_settings FOR INSERT
      WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_billing_settings' AND policyname='org_billing_settings_update_admin') THEN
    CREATE POLICY org_billing_settings_update_admin ON public.org_billing_settings FOR UPDATE
      USING (public.has_org_admin_role(auth.uid(), org_id));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_org_billing_settings_set_updated_at ON public.org_billing_settings;
CREATE TRIGGER trg_org_billing_settings_set_updated_at
  BEFORE UPDATE ON public.org_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. Ensure schedule_events has all required columns
-- ============================================================
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS start_at   timestamptz;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS end_at     timestamptz;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS timezone   text;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS team_id    uuid;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS status     text;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS notes      text;

UPDATE public.schedule_events
SET start_at = COALESCE(start_at, start_time),
    end_at   = COALESCE(end_at, end_time)
WHERE start_at IS NULL OR end_at IS NULL;

UPDATE public.schedule_events
SET timezone = 'America/Montreal'
WHERE timezone IS NULL OR timezone = '';

-- ============================================================
-- 5. Ensure jobs has subtotal/tax/total columns for billing
-- ============================================================
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS subtotal  numeric(12,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_total numeric(12,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS total     numeric(12,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 6. Ensure invoices has currency column
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'currency'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN currency text NOT NULL DEFAULT 'CAD';
  END IF;
END $$;

-- ============================================================
-- 7. Ensure audit_events has event_type column + RLS
-- ============================================================
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_events_select_org') THEN
    CREATE POLICY audit_events_select_org ON public.audit_events FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_events_insert_org') THEN
    CREATE POLICY audit_events_insert_org ON public.audit_events FOR INSERT
      WITH CHECK (public.has_org_membership(auth.uid(), org_id));
  END IF;
END $$;

COMMIT;
