-- =============================================================================
-- Migration: Request → Pipeline + Map pin sync
--
-- Problems solved:
--   1. The frontend reads pipeline_deals_visible, but that view was never
--      created in prod (migrations 20260422/20260508 reference the dropped
--      `leads` table and can no longer be applied as-is). Result: the
--      Pipeline page shows nothing even though deals exist.
--   2. Prod pipeline_deals.stage still holds legacy slugs
--      (new, follow_up_1, follow_up_2, closed) — migrate to the canonical
--      [new_prospect, no_response, quote_sent, closed_won, closed_lost].
--   3. Map pins (field_pins / field_house_profiles) never follow the CRM
--      client status. Add a trigger so a client status/lead_status change
--      updates the linked map pin automatically.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. won_at column (planned by 20260422, never applied in prod)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_deals
  ADD COLUMN IF NOT EXISTS won_at timestamptz NULL;

COMMENT ON COLUMN public.pipeline_deals.won_at
  IS 'Timestamp when deal moved to closed_won. Used for auto-removal after 2 days.';

-- ---------------------------------------------------------------------------
-- 2. Migrate legacy stage slugs to canonical values
--    Drop the old CHECK first — prod has a legacy-slugs-only constraint that
--    would reject the canonical values during the UPDATEs below.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_deals DROP CONSTRAINT IF EXISTS pipeline_deals_stage_check;

UPDATE public.pipeline_deals SET stage = 'new_prospect' WHERE stage IN ('new', 'lead', 'qualified');
UPDATE public.pipeline_deals SET stage = 'no_response'  WHERE stage IN ('follow_up_1', 'contacted', 'follow_up', 'proposal');
UPDATE public.pipeline_deals SET stage = 'quote_sent'   WHERE stage IN ('follow_up_2', 'follow_up_3', 'estimate_sent', 'negotiation');
UPDATE public.pipeline_deals SET stage = 'closed_won'   WHERE stage IN ('closed', 'won');
UPDATE public.pipeline_deals SET stage = 'closed_lost'  WHERE stage IN ('lost', 'archived');
-- Catch-all so the CHECK constraint below cannot fail on stray values
UPDATE public.pipeline_deals SET stage = 'new_prospect'
WHERE stage NOT IN ('new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost');

-- Backfill won_at / lost_at so the visibility window works for old deals
UPDATE public.pipeline_deals SET won_at  = COALESCE(won_at, updated_at) WHERE stage = 'closed_won'  AND won_at  IS NULL;
UPDATE public.pipeline_deals SET lost_at = COALESCE(lost_at, updated_at) WHERE stage = 'closed_lost' AND lost_at IS NULL;

ALTER TABLE public.pipeline_deals
  ADD CONSTRAINT pipeline_deals_stage_check
  CHECK (stage IN ('new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost'));

-- ---------------------------------------------------------------------------
-- 3. set_deal_stage RPC — canonical stages, legacy input tolerated.
--    DROP first: the deployed version may have a different return type,
--    which CREATE OR REPLACE cannot change.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_deal_stage(uuid, text);

CREATE FUNCTION public.set_deal_stage(p_deal_id uuid, p_stage text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deal      public.pipeline_deals%rowtype;
  v_old_stage text;
  v_stage     text;
BEGIN
  v_stage := CASE p_stage
    WHEN 'new'         THEN 'new_prospect'
    WHEN 'lead'        THEN 'new_prospect'
    WHEN 'qualified'   THEN 'new_prospect'
    WHEN 'follow_up_1' THEN 'no_response'
    WHEN 'contacted'   THEN 'no_response'
    WHEN 'follow_up_2' THEN 'quote_sent'
    WHEN 'follow_up_3' THEN 'quote_sent'
    WHEN 'closed'      THEN 'closed_won'
    WHEN 'won'         THEN 'closed_won'
    WHEN 'lost'        THEN 'closed_lost'
    ELSE p_stage
  END;

  IF v_stage NOT IN ('new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost') THEN
    RAISE EXCEPTION 'Invalid stage: %', p_stage;
  END IF;

  SELECT * INTO v_deal
  FROM public.pipeline_deals
  WHERE id = p_deal_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_deal.id IS NULL THEN
    RAISE EXCEPTION 'Deal not found or deleted';
  END IF;

  -- auth.uid() is NULL for service_role calls; enforce membership for users
  IF auth.uid() IS NOT NULL AND NOT public.has_org_membership(auth.uid(), v_deal.org_id) THEN
    RAISE EXCEPTION 'Not allowed for this organization';
  END IF;

  v_old_stage := v_deal.stage;

  UPDATE public.pipeline_deals
  SET stage      = v_stage,
      won_at     = CASE WHEN v_stage = 'closed_won'  THEN COALESCE(won_at, now())  ELSE NULL END,
      lost_at    = CASE WHEN v_stage = 'closed_lost' THEN COALESCE(lost_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE id = v_deal.id;

  RETURN jsonb_build_object('deal_id', v_deal.id, 'stage', v_stage, 'old_stage', v_old_stage);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_deal_stage(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. pipeline_deals_visible — the view the frontend Kanban reads.
--    lead_id now points at clients (leads table was dropped).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.pipeline_deals_visible
WITH (security_invoker = true) AS
SELECT pd.*
FROM public.pipeline_deals pd
WHERE pd.deleted_at IS NULL
  AND (
    pd.lead_id IS NULL
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pd.lead_id AND c.deleted_at IS NULL)
  )
  AND (
    pd.client_id IS NULL
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pd.client_id AND c.deleted_at IS NULL)
  )
  AND NOT (pd.stage = 'closed_won'  AND pd.won_at  IS NOT NULL AND pd.won_at  < now() - interval '2 days')
  AND NOT (pd.stage = 'closed_lost' AND pd.lost_at IS NOT NULL AND pd.lost_at < now() - interval '15 days');

COMMENT ON VIEW public.pipeline_deals_visible
  IS 'Pipeline deals displayed in the Kanban. Filters out deleted, orphaned, and expired WON/LOST deals.';

GRANT SELECT ON public.pipeline_deals_visible TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Cleanup cron — canonical stage slugs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_pipeline_deals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_lost_count integer := 0;
  v_won_count  integer := 0;
BEGIN
  WITH deleted_lost AS (
    UPDATE public.pipeline_deals
    SET deleted_at = now(), updated_at = now()
    WHERE deleted_at IS NULL
      AND stage = 'closed_lost'
      AND lost_at IS NOT NULL
      AND lost_at <= now() - interval '15 days'
    RETURNING id
  )
  SELECT count(*) INTO v_lost_count FROM deleted_lost;

  WITH deleted_won AS (
    UPDATE public.pipeline_deals
    SET deleted_at = now(), updated_at = now()
    WHERE deleted_at IS NULL
      AND stage = 'closed_won'
      AND won_at IS NOT NULL
      AND won_at <= now() - interval '2 days'
    RETURNING id
  )
  SELECT count(*) INTO v_won_count FROM deleted_won;

  RETURN jsonb_build_object('lost_cleaned', v_lost_count, 'won_cleaned', v_won_count, 'cleaned_at', now());
END;
$fn$;

DO $cron_setup$
BEGIN
  BEGIN
    PERFORM cron.unschedule('cleanup-lost-pipeline-deals');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM cron.unschedule('cleanup-expired-pipeline-deals');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule(
    'cleanup-expired-pipeline-deals',
    '0 * * * *',
    'select public.cleanup_expired_pipeline_deals()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available, skipping cron setup. View filter handles visibility.';
END;
$cron_setup$;

-- ---------------------------------------------------------------------------
-- 6. Map pin follows client status.
--    Any update to clients.status / clients.lead_status re-paints the linked
--    field_house_profiles + field_pins (matched via client_id or lead_id —
--    both hold client ids since the leads/clients merge).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_field_pin_from_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pin_status text;
  v_pin_color  text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.lead_status IS NOT DISTINCT FROM OLD.lead_status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'active' THEN
    v_pin_status := 'sale';
  ELSIF NEW.status = 'lead' THEN
    v_pin_status := CASE COALESCE(NEW.lead_status, 'new_prospect')
      WHEN 'new_prospect'  THEN 'lead'
      WHEN 'new'           THEN 'lead'
      WHEN 'qualified'     THEN 'lead'
      WHEN 'no_response'   THEN 'no_answer'
      WHEN 'follow_up_1'   THEN 'no_answer'
      WHEN 'contacted'     THEN 'no_answer'
      WHEN 'quote_sent'    THEN 'quote_sent'
      WHEN 'follow_up_2'   THEN 'quote_sent'
      WHEN 'follow_up_3'   THEN 'quote_sent'
      WHEN 'estimate_sent' THEN 'quote_sent'
      WHEN 'closed_won'    THEN 'sale'
      WHEN 'closed'        THEN 'sale'
      WHEN 'won'           THEN 'sale'
      WHEN 'closed_lost'   THEN 'not_interested'
      WHEN 'lost'          THEN 'not_interested'
      ELSE 'lead'
    END;
  ELSE
    -- Archived / unknown client statuses: leave the pin untouched
    RETURN NEW;
  END IF;

  v_pin_color := CASE v_pin_status
    WHEN 'lead'           THEN '#3b82f6'
    WHEN 'no_answer'      THEN '#9ca3af'
    WHEN 'quote_sent'     THEN '#a855f7'
    WHEN 'sale'           THEN '#22c55e'
    WHEN 'not_interested' THEN '#ef4444'
    ELSE '#6b7280'
  END;

  UPDATE public.field_house_profiles
  SET current_status = v_pin_status, last_activity_at = now(), updated_at = now()
  WHERE org_id = NEW.org_id
    AND deleted_at IS NULL
    AND (client_id = NEW.id OR lead_id = NEW.id);

  UPDATE public.field_pins fp
  SET status = v_pin_status, pin_color = v_pin_color, updated_at = now()
  FROM public.field_house_profiles fhp
  WHERE fp.house_id = fhp.id
    AND fhp.org_id = NEW.org_id
    AND fhp.deleted_at IS NULL
    AND (fhp.client_id = NEW.id OR fhp.lead_id = NEW.id);

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_clients_sync_field_pin ON public.clients;
CREATE TRIGGER trg_clients_sync_field_pin
  AFTER UPDATE OF status, lead_status ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_field_pin_from_client();

COMMIT;

-- Reload PostgREST schema cache (new view + changed RPC signature)
NOTIFY pgrst, 'reload schema';
