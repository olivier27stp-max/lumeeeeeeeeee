-- Generic Outbound Webhook System
-- Lets each org register external endpoints (Zapier, Make, n8n, custom) and
-- subscribe to CRM events. Deliveries are persisted for audit + retry.

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  last_delivery_status text
);

CREATE INDEX IF NOT EXISTS wh_endpoints_org_idx
  ON public.webhook_endpoints (org_id)
  WHERE is_active = true;

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wh_endpoints_org_read ON public.webhook_endpoints;
CREATE POLICY wh_endpoints_org_read ON public.webhook_endpoints
  FOR SELECT
  USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS wh_endpoints_org_write ON public.webhook_endpoints;
CREATE POLICY wh_endpoints_org_write ON public.webhook_endpoints
  FOR ALL
  USING (public.has_org_admin_role(auth.uid(), org_id))
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));


CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  http_status integer,
  response_body text,
  error_message text,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT wh_deliveries_status_check CHECK (status IN ('pending','sent','failed','abandoned'))
);

CREATE INDEX IF NOT EXISTS wh_deliveries_pending_idx
  ON public.webhook_deliveries (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS wh_deliveries_org_idx
  ON public.webhook_deliveries (org_id, created_at DESC);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wh_deliveries_org_read ON public.webhook_deliveries;
CREATE POLICY wh_deliveries_org_read ON public.webhook_deliveries
  FOR SELECT
  USING (public.has_org_membership(auth.uid(), org_id));

NOTIFY pgrst, 'reload schema';
