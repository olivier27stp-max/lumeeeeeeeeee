-- ORDER_HINT: 2/2 — timestamp collision with 20260329000000_backend_audit_cleanup.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

/* ═══════════════════════════════════════════════════════════════
   Migration — Communications Module

   Adds structured communication channels, unified message log,
   and org-level settings for SMS + Email.

   Builds on existing tables:
   - conversations / messages (SMS, from 20260309)
   - email_templates (from 20260326)

   New tables:
   1. communication_channels — per-org SMS number + per-user email
   2. communication_messages — unified log (SMS + email, job-linked)
   3. communication_settings — org-level toggles
   ═══════════════════════════════════════════════════════════════ */

-- ═══════════════════════════════════════════════════════════════
-- 1. communication_channels
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.communication_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('sms', 'email')),
  provider text NOT NULL DEFAULT 'twilio',
  phone_number text,
  email_address text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'provisioning', 'failed')),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_channels_org ON public.communication_channels(org_id);
CREATE INDEX IF NOT EXISTS idx_comm_channels_org_type ON public.communication_channels(org_id, channel_type);

ALTER TABLE public.communication_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comm_channels_org_access" ON public.communication_channels
  FOR ALL USING (public.has_org_membership(auth.uid(), org_id));

-- ═══════════════════════════════════════════════════════════════
-- 2. communication_messages — unified log
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('sms', 'email')),
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  provider text,
  channel_id uuid REFERENCES public.communication_channels(id) ON DELETE SET NULL,
  from_value text,
  to_value text,
  subject text,
  body_text text,
  body_html text,
  template_key text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received', 'opened', 'bounced')),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  provider_message_id text,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_org ON public.communication_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_job ON public.communication_messages(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_messages_client ON public.communication_messages(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_messages_org_created ON public.communication_messages(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_messages_provider_id ON public.communication_messages(provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.communication_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comm_messages_org_access" ON public.communication_messages
  FOR ALL USING (public.has_org_membership(auth.uid(), org_id));

-- ═══════════════════════════════════════════════════════════════
-- 3. communication_settings
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.communication_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.orgs(id) ON DELETE CASCADE,
  sms_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT true,
  sms_two_way_enabled boolean NOT NULL DEFAULT false,
  default_sms_channel_id uuid REFERENCES public.communication_channels(id) ON DELETE SET NULL,
  booking_confirmation_sms_enabled boolean NOT NULL DEFAULT false,
  booking_confirmation_email_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.communication_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comm_settings_org_access" ON public.communication_settings
  FOR ALL USING (public.has_org_membership(auth.uid(), org_id));

-- ═══════════════════════════════════════════════════════════════
-- 4. Auto-create settings for existing orgs
-- ═══════════════════════════════════════════════════════════════

INSERT INTO public.communication_settings (org_id)
SELECT id FROM public.orgs
WHERE id NOT IN (SELECT org_id FROM public.communication_settings)
ON CONFLICT (org_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 5. Trigger: auto-create communication_settings for new orgs
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_create_comm_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.communication_settings (org_id)
  VALUES (NEW.id)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_auto_create_comm_settings ON public.orgs;
CREATE TRIGGER trg_auto_create_comm_settings
  AFTER INSERT ON public.orgs
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_comm_settings();

-- ═══════════════════════════════════════════════════════════════
-- 6. Auto-update updated_at triggers
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_comm_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_comm_channels_updated ON public.communication_channels;
CREATE TRIGGER trg_comm_channels_updated
  BEFORE UPDATE ON public.communication_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_comm_updated_at();

DROP TRIGGER IF EXISTS trg_comm_messages_updated ON public.communication_messages;
CREATE TRIGGER trg_comm_messages_updated
  BEFORE UPDATE ON public.communication_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_comm_updated_at();

DROP TRIGGER IF EXISTS trg_comm_settings_updated ON public.communication_settings;
CREATE TRIGGER trg_comm_settings_updated
  BEFORE UPDATE ON public.communication_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_comm_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 7. RPC: provision_sms_channel
--    Called after Twilio number is purchased server-side
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.provision_sms_channel(
  p_org_id uuid,
  p_phone_number text,
  p_provider text DEFAULT 'twilio',
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_channel_id uuid;
BEGIN
  -- Deactivate any existing SMS channels for this org
  UPDATE public.communication_channels
  SET is_default = false, status = 'inactive'
  WHERE org_id = p_org_id AND channel_type = 'sms' AND is_default = true;

  -- Insert new channel
  INSERT INTO public.communication_channels (
    org_id, channel_type, provider, phone_number, is_default, status, metadata
  ) VALUES (
    p_org_id, 'sms', p_provider, p_phone_number, true, 'active', p_metadata
  )
  RETURNING id INTO v_channel_id;

  -- Update settings
  UPDATE public.communication_settings
  SET sms_enabled = true, default_sms_channel_id = v_channel_id, sms_two_way_enabled = true
  WHERE org_id = p_org_id;

  RETURN v_channel_id;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════
-- 8. Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
