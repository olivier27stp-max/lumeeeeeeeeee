-- Location tracking: org-level on/off switch + per-user consent (Loi 25 / GDPR).
--
-- Auto-locate-on-login streams every signed-in user's position into
-- tracking_live_locations. Continuous employee geolocation requires (a) the org
-- to have the feature enabled and (b) informed consent from each user. This
-- migration adds both gates; the frontend refuses to start a tracking session
-- unless org `enabled` is true AND the user's `location_consent` is true.

-- ── Org-level switch — one row per org, admin-managed ───────────────────────
CREATE TABLE IF NOT EXISTS public.location_tracking_settings (
  org_id      uuid PRIMARY KEY,
  -- Master switch for live location tracking across the org. Defaults ON to
  -- preserve current behaviour; admins can disable it org-wide.
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.location_tracking_settings ENABLE ROW LEVEL SECURITY;

-- Any org member can READ the setting (the tracking gate needs it).
DROP POLICY IF EXISTS location_tracking_settings_select_org ON public.location_tracking_settings;
CREATE POLICY location_tracking_settings_select_org ON public.location_tracking_settings
  FOR SELECT USING (has_org_membership((SELECT auth.uid()), org_id));

-- Only admins/owners can CHANGE it.
DROP POLICY IF EXISTS location_tracking_settings_insert_admin ON public.location_tracking_settings;
CREATE POLICY location_tracking_settings_insert_admin ON public.location_tracking_settings
  FOR INSERT WITH CHECK (has_org_admin_role((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS location_tracking_settings_update_admin ON public.location_tracking_settings;
CREATE POLICY location_tracking_settings_update_admin ON public.location_tracking_settings
  FOR UPDATE USING (has_org_admin_role((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS location_tracking_settings_delete_admin ON public.location_tracking_settings;
CREATE POLICY location_tracking_settings_delete_admin ON public.location_tracking_settings
  FOR DELETE USING (has_org_admin_role((SELECT auth.uid()), org_id));

DROP TRIGGER IF EXISTS trg_location_tracking_settings_updated_at ON public.location_tracking_settings;
CREATE TRIGGER trg_location_tracking_settings_updated_at
  BEFORE UPDATE ON public.location_tracking_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Per-user consent ────────────────────────────────────────────────────────
-- Tri-state: NULL = never asked (show the consent prompt), true = consented,
-- false = explicitly declined (do not track, do not nag again).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_consent boolean;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_consent_at timestamptz;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.location_tracking_settings CASCADE;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS location_consent;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS location_consent_at;
-- ════════════════════════════════════════════════════════════════════════════
