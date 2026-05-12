-- =====================================================================
-- Email marketing campaigns — 2026-05-12
-- Bulk email sends to segments of clients (newsletters, promos, reminders)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  -- Segment: 'all_clients' | 'recent_clients' (last 90d) | 'overdue_clients' | 'custom_query'
  segment text NOT NULL DEFAULT 'all_clients',
  custom_query jsonb,
  status text NOT NULL DEFAULT 'draft', -- draft|scheduled|sending|sent|failed
  scheduled_at timestamptz,
  sent_at timestamptz,
  total_recipients integer DEFAULT 0,
  total_sent integer DEFAULT 0,
  total_failed integer DEFAULT 0,
  total_bounced integer DEFAULT 0,
  total_opened integer DEFAULT 0,
  total_clicked integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_campaigns_status_check CHECK (status IN ('draft','scheduled','sending','sent','failed'))
);
CREATE INDEX IF NOT EXISTS email_campaigns_org_idx ON public.email_campaigns (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_campaigns_scheduled_idx ON public.email_campaigns (status, scheduled_at)
  WHERE status = 'scheduled';

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_campaigns_org_read ON public.email_campaigns;
CREATE POLICY email_campaigns_org_read ON public.email_campaigns
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS email_campaigns_org_write ON public.email_campaigns;
CREATE POLICY email_campaigns_org_write ON public.email_campaigns
  FOR ALL USING (public.has_org_admin_role(auth.uid(), org_id))
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));

-- Sent log per recipient
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending|sent|failed|bounced
  error_message text,
  opened_at timestamptz,
  clicked_at timestamptz,
  sent_at timestamptz,
  CONSTRAINT email_campaign_recipients_status_check CHECK (status IN ('pending','sent','failed','bounced'))
);
CREATE INDEX IF NOT EXISTS ecr_campaign_idx ON public.email_campaign_recipients (campaign_id);
CREATE INDEX IF NOT EXISTS ecr_org_idx ON public.email_campaign_recipients (org_id);

ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ecr_org_read ON public.email_campaign_recipients;
CREATE POLICY ecr_org_read ON public.email_campaign_recipients
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

NOTIFY pgrst, 'reload schema';
