-- V2: Add camera_state and metadata columns to quote_measurements
-- camera_state: saves the map view (center, zoom, tilt, heading) per measurement
-- metadata: future-proof JSONB for agent/automation/annotations

ALTER TABLE public.quote_measurements
  ADD COLUMN IF NOT EXISTS camera_state jsonb NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NULL DEFAULT '{}';

-- Camera state per quote (saved view when user leaves the measurement page)
CREATE TABLE IF NOT EXISTS public.quote_measurement_camera (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL DEFAULT public.current_org_id(),
  quote_id   uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  address    text NOT NULL DEFAULT '',
  camera     jsonb NOT NULL DEFAULT '{}',
  unit_system text NOT NULL DEFAULT 'imperial',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id)
);

CREATE INDEX IF NOT EXISTS idx_qmc_quote ON public.quote_measurement_camera(quote_id);

ALTER TABLE public.quote_measurement_camera ENABLE ROW LEVEL SECURITY;

CREATE POLICY qmc_select ON public.quote_measurement_camera FOR SELECT
  USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY qmc_insert ON public.quote_measurement_camera FOR INSERT
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY qmc_update ON public.quote_measurement_camera FOR UPDATE
  USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY qmc_delete ON public.quote_measurement_camera FOR DELETE
  USING (public.has_org_membership(auth.uid(), org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_measurement_camera TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_measurement_camera TO service_role;

CREATE OR REPLACE FUNCTION public.qmc_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qmc_updated_at_trigger
  BEFORE UPDATE ON public.quote_measurement_camera
  FOR EACH ROW EXECUTE FUNCTION public.qmc_updated_at();
