-- Demo requests captured from the public "Book a demo" form.
-- Public can INSERT only via service-role server route; reads are platform-admin only.
CREATE TABLE IF NOT EXISTS public.demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  industry text NOT NULL,
  employee_count text,
  source text,
  availability text,
  message text,
  status text NOT NULL DEFAULT 'new', -- new|contacted|demoed|converted|rejected
  notes text,
  contacted_at timestamptz,
  converted_at timestamptz,
  converted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  CONSTRAINT demo_requests_status_check CHECK (status IN ('new','contacted','demoed','converted','rejected'))
);

CREATE INDEX IF NOT EXISTS demo_requests_status_idx ON public.demo_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_requests_email_idx ON public.demo_requests (email);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Only the platform owner has access via RLS (the server uses the service role
-- to bypass RLS for INSERT from the public route and for admin reads).
DROP POLICY IF EXISTS demo_requests_platform_admin ON public.demo_requests;
CREATE POLICY demo_requests_platform_admin ON public.demo_requests
  FOR ALL USING (auth.uid()::text = current_setting('app.platform_owner_id', true));
