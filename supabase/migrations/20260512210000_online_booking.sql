-- Online Booking — public booking pages + bookings
-- Allows orgs to publish a public URL where customers self-book a service slot.

-- ── booking_pages ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  service_type text,
  duration_minutes integer NOT NULL DEFAULT 60,
  buffer_minutes integer NOT NULL DEFAULT 15,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb, -- {monday:[{start:'09:00',end:'17:00'}], ...}
  advance_notice_hours integer NOT NULL DEFAULT 24,
  max_days_ahead integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_pages_org_idx ON public.booking_pages (org_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS booking_pages_slug_active_idx ON public.booking_pages (slug) WHERE is_active = true;

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_pages_org_read ON public.booking_pages;
CREATE POLICY booking_pages_org_read ON public.booking_pages
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS booking_pages_org_write ON public.booking_pages;
CREATE POLICY booking_pages_org_write ON public.booking_pages
  FOR ALL USING (public.has_org_admin_role(auth.uid(), org_id))
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));

-- ── bookings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  booking_page_id uuid REFERENCES public.booking_pages(id) ON DELETE SET NULL,
  customer_first_name text NOT NULL,
  customer_last_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  service_address text,
  notes text,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_status_check CHECK (status IN ('pending','confirmed','cancelled','completed'))
);
CREATE INDEX IF NOT EXISTS bookings_org_idx ON public.bookings (org_id);
CREATE INDEX IF NOT EXISTS bookings_scheduled_idx ON public.bookings (scheduled_at);
CREATE INDEX IF NOT EXISTS bookings_page_scheduled_idx ON public.bookings (booking_page_id, scheduled_at)
  WHERE status IN ('pending','confirmed');

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_org_read ON public.bookings;
CREATE POLICY bookings_org_read ON public.bookings
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS bookings_org_update ON public.bookings;
CREATE POLICY bookings_org_update ON public.bookings
  FOR UPDATE USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS bookings_org_delete ON public.bookings;
CREATE POLICY bookings_org_delete ON public.bookings
  FOR DELETE USING (public.has_org_admin_role(auth.uid(), org_id));

-- Public INSERT happens via the /api/booking endpoint using service_role; no RLS INSERT policy.

NOTIFY pgrst, 'reload schema';
